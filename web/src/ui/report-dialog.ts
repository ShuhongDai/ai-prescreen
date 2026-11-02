// The report form, a modal dialog for a new phrase or a false positive. A report goes to
// the Worker (api.aiprescreen.fyi), which checks Turnstile and opens the public GitHub issue,
// so no GitHub account is needed; "Open on GitHub instead" stays as the secondary way.
// Turnstile's script is loaded when a form opens (never for an analysis), its check runs on
// "Send report", and the widget is removed when the form closes, so nothing keeps running.
// Text goes in through textContent and value only (never innerHTML).

import { FIELD_MAX, TIER_CHOICES, TURNSTILE_ACTION } from '../report-contract.ts';
import { sendReport } from './api.ts';
import { NEW_TAB_HINT, reportText } from './report.ts';
import { buildRequest, errorText, githubUrl, REPORT_TEXT, type ReportDraft } from './report-form.ts';
import { loadTurnstile, TURNSTILE_SITE_KEY, type Turnstile } from './turnstile.ts';

export interface ReportDialogOptions {
  /** The report was sent, or the reader opened it on GitHub instead. */
  onReported(draft: ReportDraft): void;
  /** Where focus goes on close when the element it came from is gone (a dismissed highlight). */
  fallbackFocus(): HTMLElement | null;
}

export interface ReportDialog {
  readonly element: HTMLDialogElement;
  open(draft: ReportDraft, returnFocus: HTMLElement | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function field(control: Control, label: string, optional: boolean): HTMLDivElement {
  const wrap = el('div', 'field');
  control.id = `report-field-${control.name}`;
  const lab = el('label', 'field-label', label);
  lab.htmlFor = control.id;
  if (optional) lab.append(el('span', 'field-optional', ' (optional)'));
  wrap.append(lab, control);
  return wrap;
}

function textInput(name: string, max: number, placeholder = ''): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.name = name;
  input.maxLength = max;
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function textArea(name: string, max: number): HTMLTextAreaElement {
  const area = el('textarea');
  area.name = name;
  area.maxLength = max;
  area.rows = 3;
  area.spellcheck = false;
  return area;
}

export function createReportDialog(options: ReportDialogOptions): ReportDialog {
  // ---- DOM (built once) ----
  const dialog = el('dialog', 'report-dialog');
  dialog.setAttribute('aria-labelledby', 'report-title');
  dialog.setAttribute('aria-describedby', 'report-lede');
  const form = el('form', 'report-form');
  form.noValidate = true;

  const title = el('h2', 'report-title');
  title.id = 'report-title';
  const closeButton = el('button', 'icon-button report-close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', REPORT_TEXT.close);
  const closeGlyph = el('span', '', '×');
  closeGlyph.setAttribute('aria-hidden', 'true');
  closeButton.append(closeGlyph);
  const head = el('div', 'report-head');
  head.append(title, closeButton);
  const lede = el('p', 'report-lede');
  lede.id = 'report-lede';

  // A false positive: the highlight and its entry, as read-only text.
  const subject = el('p', 'report-subject');
  const subjectQuote = el('span', 'report-quote');
  const subjectEntry = el('code', 'report-entry');
  subject.append(subjectQuote, el('span', 'report-entry-label', ` · ${REPORT_TEXT.entry} `), subjectEntry);

  const phrase = textInput('phrase', FIELD_MAX.phrase);
  phrase.required = true;
  const tier = el('select', 'select');
  tier.name = 'tier';
  for (const choice of TIER_CHOICES) tier.append(new Option(choice, choice, choice === 'overused word', choice === 'overused word'));
  const example = textArea('example', FIELD_MAX.example);
  const model = textInput('model', FIELD_MAX.model, 'e.g. GPT-4o, Claude, Gemini');
  const comment = textArea('comment', FIELD_MAX.comment);
  const phraseFields = [field(phrase, 'Phrase', false), field(tier, 'Suggested tier', false)];
  const exampleField = field(example, 'Example sentence', true);
  const modelField = field(model, 'Model it came from', true);
  const commentField = field(comment, 'Comment', true);

  const notice = el('p', 'report-public', REPORT_TEXT.public);
  const check = el('div', 'report-check');
  const status = el('p', 'report-status');
  status.setAttribute('role', 'status');

  const submit = el('button', 'button button--primary', REPORT_TEXT.send);
  submit.type = 'submit';
  const github = el('a', 'report-github');
  github.target = '_blank';
  github.rel = 'noopener noreferrer';
  const arrow = el('span', '', ' ↗');
  arrow.setAttribute('aria-hidden', 'true');
  github.append(REPORT_TEXT.github, arrow, el('span', 'sr-only', NEW_TAB_HINT));
  const actions = el('div', 'report-actions');
  actions.append(submit, github);

  // Shown instead of the form once the report is sent.
  const done = el('div', 'report-done');
  const doneText = el('p', 'report-done-text');
  const doneClose = el('button', 'button', REPORT_TEXT.close);
  doneClose.type = 'button';
  done.append(doneText, doneClose);

  const body = el('div', 'report-body');
  body.append(subject, ...phraseFields, exampleField, modelField, commentField, notice, check, status, actions);
  form.append(head, lede, body, done);
  dialog.append(form);

  // ---- State ----
  let draft: ReportDraft = { kind: 'new-phrase', phrase: '' };
  let returnTo: HTMLElement | null = null;
  let turnstile: Turnstile | null = null;
  let widget: string | undefined;
  let token = '';
  /** "Send report" was pressed: send as soon as Turnstile has a token. */
  let waiting = false;
  /** The current form's Turnstile setup (loading the script, rendering the widget). */
  let ready: Promise<void> = Promise.resolve();
  let sending = false;
  /** Counts opened forms: an answer that comes after its form was closed only reports back. */
  let generation = 0;
  /** Gives up on a check that never calls back. */
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  const CHECK_TIMEOUT_MS = 60_000;

  function stopWaiting(): void {
    waiting = false;
    clearTimeout(checkTimer);
    checkTimer = undefined;
  }

  function setStatus(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  const fields = () => ({ phrase: phrase.value, tier: tier.value, example: example.value, model: model.value, comment: comment.value });

  /**
   * Loads Turnstile and renders the widget, which waits for execute() (on "Send report").
   * Never rejects: a failure shows in the status and leaves no widget.
   */
  async function prepareCheck(): Promise<void> {
    token = '';
    try {
      turnstile = await loadTurnstile();
      if (!dialog.open || widget !== undefined) return;
      widget = renderWidget(turnstile);
    } catch {
      widget = undefined;
      setStatus(REPORT_TEXT.checkFailed, 'error');
    }
  }

  function renderWidget(t: Turnstile): string | undefined {
    return t.render(check, {
      sitekey: TURNSTILE_SITE_KEY,
      action: TURNSTILE_ACTION,
      appearance: 'interaction-only',
      execution: 'execute',
      'refresh-expired': 'manual',
      size: 'flexible',
      theme: 'auto',
      callback: (value: string) => {
        token = value;
        if (waiting) void send();
      },
      'expired-callback': () => {
        token = '';
      },
      'error-callback': () => {
        token = '';
        stopWaiting();
        setStatus(REPORT_TEXT.checkFailed, 'error');
        return true;
      },
    });
  }

  /** Runs the check once the widget is ready; its callback then sends the report. */
  function runCheck(): void {
    if (!waiting || !dialog.open) return;
    if (!turnstile || widget === undefined) {
      stopWaiting();
      setStatus(REPORT_TEXT.checkFailed, 'error');
      return;
    }
    checkTimer = setTimeout(() => {
      stopWaiting();
      setStatus(REPORT_TEXT.checkFailed, 'error');
    }, CHECK_TIMEOUT_MS);
    turnstile.reset(widget);
    turnstile.execute(widget);
  }

  async function send(): Promise<void> {
    stopWaiting();
    const request = buildRequest(draft, fields(), token);
    if (!request) {
      // The phrase was emptied while the check ran.
      setStatus(REPORT_TEXT.phraseMissing, 'error');
      phrase.focus();
      return;
    }
    token = ''; // a token is good for one check only
    const sentDraft = draft;
    const mine = generation;
    sending = true;
    submit.disabled = true;
    setStatus(REPORT_TEXT.sending);
    const res = await sendReport(request);
    sending = false;
    submit.disabled = false;
    if (res.ok) options.onReported(sentDraft);
    // The form was closed (and maybe another one opened) meanwhile: nothing more to show.
    if (mine !== generation || !dialog.open) return;
    if (res.ok) {
      doneText.textContent = REPORT_TEXT.thanks;
      if (res.issue.number > 0) {
        const link = el('a', '', `${REPORT_TEXT.issue(res.issue.number)}`);
        link.href = res.issue.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const linkArrow = el('span', '', ' ↗');
        linkArrow.setAttribute('aria-hidden', 'true');
        link.append(linkArrow, el('span', 'sr-only', NEW_TAB_HINT));
        doneText.append(' ', link, '.');
      }
      dialog.dataset.state = 'sent';
      doneClose.focus();
      return;
    }
    setStatus(errorText(res.error), 'error');
    if (turnstile && widget !== undefined) turnstile.reset(widget);
  }

  // ---- Events ----
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sending) return;
    if (draft.kind === 'new-phrase' && phrase.value.trim() === '') {
      setStatus(REPORT_TEXT.phraseMissing, 'error');
      phrase.focus();
      return;
    }
    if (waiting) return; // the check is already running
    if (!token) {
      waiting = true;
      setStatus(REPORT_TEXT.checking);
      void ready.then(runCheck);
      return;
    }
    void send();
  });
  phrase.addEventListener('input', () => {
    github.href = githubUrl(draft, phrase.value);
  });
  github.addEventListener('click', () => {
    options.onReported(draft);
    dialog.close();
  });
  closeButton.addEventListener('click', () => dialog.close());
  doneClose.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    stopWaiting();
    token = '';
    if (turnstile && widget !== undefined) turnstile.remove(widget);
    widget = undefined;
    const target = returnTo?.isConnected ? returnTo : options.fallbackFocus();
    target?.focus({ preventScroll: true });
  });

  return {
    element: dialog,
    open(next, focusAfter) {
      generation++;
      draft = next;
      returnTo = focusAfter;
      const isPhrase = next.kind === 'new-phrase';
      dialog.dataset.kind = next.kind;
      delete dialog.dataset.state;
      form.reset();
      title.textContent = isPhrase ? REPORT_TEXT.phraseTitle : REPORT_TEXT.falsePositiveTitle;
      lede.textContent = isPhrase ? REPORT_TEXT.phraseLede : REPORT_TEXT.falsePositiveLede;
      subject.hidden = isPhrase;
      for (const f of [...phraseFields, modelField]) f.hidden = !isPhrase;
      commentField.hidden = isPhrase;
      if (next.kind === 'new-phrase') {
        phrase.value = reportText(next.phrase, FIELD_MAX.phrase);
      } else {
        subjectQuote.textContent = `“${next.matchedText.replace(/\s+/g, ' ').trim()}”`;
        subjectEntry.textContent = next.entryId;
      }
      github.href = githubUrl(next, phrase.value);
      setStatus('');
      // Still sending the previous form's report: wait for it.
      submit.disabled = sending;
      dialog.showModal();
      (isPhrase && phrase.value === '' ? phrase : isPhrase ? tier : example).focus();
      ready = prepareCheck();
    },
  };
}
