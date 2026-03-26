import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunOperatorAction } from '../lib/run-operator-actions';
import type { RunActionType, TaskActionType } from '../lib/control-plane-ui-types';

type NoteDraftMap = Record<string, string>;

type OperatorActionBarProps = Readonly<{
  title: string;
  hint: string;
  actions: RunOperatorAction[];
  isPending: boolean;
  errorMessage: string | null;
  onTaskAction: (taskId: string, action: TaskActionType, note?: string) => void;
  onRunAction: (action: RunActionType, note?: string) => void;
}>;

type TaskComposerControlProps = {
  action: RunOperatorAction;
  actionKey: string;
  currentDraft: string;
  composerOpen: boolean;
  isPending: boolean;
  onOpenComposer: (actionKey: string, initialValue: string) => void;
  onCloseComposer: () => void;
  onDraftChange: (actionKey: string, nextValue: string) => void;
  onTaskAction: (taskId: string, action: TaskActionType, note?: string) => void;
};

type RunComposerControlProps = {
  action: RunOperatorAction;
  actionKey: string;
  currentDraft: string;
  composerOpen: boolean;
  isPending: boolean;
  onOpenComposer: (actionKey: string, initialValue: string) => void;
  onCloseComposer: () => void;
  onDraftChange: (actionKey: string, nextValue: string) => void;
  onRunAction: (action: RunActionType, note?: string) => void;
};

function renderTaskComposerControl(props: TaskComposerControlProps): JSX.Element | null {
  if (props.action.kind !== 'task' || !props.action.taskId || !props.action.taskAction) {
    return null;
  }

  const taskId = props.action.taskId;
  const taskAction = props.action.taskAction;
  const notePrompt = props.action.notePrompt;

  if (!notePrompt) {
    return (
      <button
        className={buttonClassName(props.action.tone)}
        disabled={props.isPending}
        onClick={() => props.onTaskAction(taskId, taskAction)}
        type="button"
      >
        {props.action.label}
      </button>
    );
  }

  const trimmedDraft = props.currentDraft.trim();

  return (
    <div className="flex flex-col items-stretch gap-2 min-w-[19rem] max-w-[28rem]">
      <button
        className={buttonClassName(props.action.tone)}
        disabled={props.isPending}
        onClick={() => props.onOpenComposer(props.actionKey, notePrompt.initialValue)}
        type="button"
      >
        {props.composerOpen ? 'Hide Note' : props.action.label}
      </button>
      {props.composerOpen ? (
        <div className="rounded-2xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>{notePrompt.title}</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>{notePrompt.helperText}</p>
          <textarea
            className="mt-3 w-full rounded-2xl px-3 py-3 text-[12px]"
            disabled={props.isPending}
            onChange={(event) => props.onDraftChange(props.actionKey, event.target.value)}
            placeholder={notePrompt.placeholder}
            rows={6}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.82)'
            }}
            value={props.currentDraft}
          />
          <div className="flex gap-2 flex-wrap mt-3">
            <button
              className={buttonClassName(props.action.tone)}
              disabled={props.isPending || (notePrompt.required && trimmedDraft.length === 0)}
              onClick={() => {
                props.onTaskAction(taskId, taskAction, trimmedDraft.length > 0 ? trimmedDraft : undefined);
                props.onCloseComposer();
              }}
              type="button"
            >
              {notePrompt.confirmLabel}
            </button>
            <button
              className="button-ghost"
              disabled={props.isPending}
              onClick={props.onCloseComposer}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderRunControl(props: RunComposerControlProps): JSX.Element | null {
  if (props.action.kind !== 'run' || !props.action.runAction) {
    return null;
  }

  const runAction = props.action.runAction;
  const notePrompt = props.action.notePrompt;

  if (!notePrompt) {
    return (
      <button
        className={buttonClassName(props.action.tone)}
        disabled={props.isPending}
        onClick={() => props.onRunAction(runAction)}
        type="button"
      >
        {props.action.label}
      </button>
    );
  }

  const trimmedDraft = props.currentDraft.trim();

  return (
    <div className="flex flex-col items-stretch gap-2 min-w-[19rem] max-w-[28rem]">
      <button
        className={buttonClassName(props.action.tone)}
        disabled={props.isPending}
        onClick={() => props.onOpenComposer(props.actionKey, notePrompt.initialValue)}
        type="button"
      >
        {props.composerOpen ? 'Hide Note' : props.action.label}
      </button>
      {props.composerOpen ? (
        <div className="rounded-2xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>{notePrompt.title}</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>{notePrompt.helperText}</p>
          <textarea
            className="mt-3 w-full rounded-2xl px-3 py-3 text-[12px]"
            disabled={props.isPending}
            onChange={(event) => props.onDraftChange(props.actionKey, event.target.value)}
            placeholder={notePrompt.placeholder}
            rows={6}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.82)'
            }}
            value={props.currentDraft}
          />
          <div className="flex gap-2 flex-wrap mt-3">
            <button
              className={buttonClassName(props.action.tone)}
              disabled={props.isPending || (notePrompt.required && trimmedDraft.length === 0)}
              onClick={() => {
                props.onRunAction(runAction, trimmedDraft.length > 0 ? trimmedDraft : undefined);
                props.onCloseComposer();
              }}
              type="button"
            >
              {notePrompt.confirmLabel}
            </button>
            <button
              className="button-ghost"
              disabled={props.isPending}
              onClick={props.onCloseComposer}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderLinkControl(action: RunOperatorAction): JSX.Element | null {
  if (action.kind !== 'link' || !action.href) {
    return null;
  }

  return action.href.startsWith('/') ? (
    <Link className="hero-link" to={action.href}>
      {action.label}
    </Link>
  ) : (
    <a className="hero-link" href={action.href} rel={action.external ? 'noreferrer' : undefined} target={action.external ? '_blank' : undefined}>
      {action.label}
    </a>
  );
}

function buttonClassName(tone: RunOperatorAction['tone']): string {
  if (tone === 'secondary' || tone === 'ghost') {
    return 'button-ghost';
  }

  return '';
}

export function OperatorActionBar(props: OperatorActionBarProps): JSX.Element | null {
  const [activeComposerKey, setActiveComposerKey] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState({} as NoteDraftMap);

  function ensureDraft(key: string, initialValue: string): void {
    setNoteDrafts((current) => {
      if (current[key] !== undefined) {
        return current;
      }

      return { ...current, [key]: initialValue };
    });
  }

  function updateDraft(key: string, nextValue: string): void {
    setNoteDrafts((current) => ({ ...current, [key]: nextValue }));
  }

  function toggleComposer(actionKey: string, initialValue: string): void {
    setActiveComposerKey((currentKey) => currentKey === actionKey ? null : actionKey);
    ensureDraft(actionKey, initialValue);
  }

  if (props.actions.length === 0 && !props.errorMessage) {
    return null;
  }

  return (
    <div className="rounded-3xl px-4 py-4 mt-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div>
        <p className="text-[10px] tracking-[0.18em] uppercase" style={{ color: 'rgba(255,255,255,0.24)' }}>{props.title}</p>
        <p className="text-[12px] mt-2" style={{ color: 'rgba(255,255,255,0.48)' }}>{props.hint}</p>
      </div>

      <div className="flex flex-col gap-3 mt-4">
        {props.actions.map((action) => {
          const key = `${action.kind}:${action.label}:${action.taskId ?? action.runAction ?? action.href ?? 'none'}`;
          const currentDraft = noteDrafts[key] ?? action.notePrompt?.initialValue ?? '';
          const composerOpen = activeComposerKey === key;
          const control = renderTaskComposerControl({
            action,
            actionKey: key,
            currentDraft,
            composerOpen,
            isPending: props.isPending,
            onOpenComposer: toggleComposer,
            onCloseComposer: () => setActiveComposerKey(null),
            onDraftChange: updateDraft,
            onTaskAction: props.onTaskAction,
          }) ?? renderRunControl({
            action,
            actionKey: key,
            currentDraft,
            composerOpen,
            isPending: props.isPending,
            onOpenComposer: toggleComposer,
            onCloseComposer: () => setActiveComposerKey(null),
            onDraftChange: updateDraft,
            onRunAction: props.onRunAction,
          }) ?? renderLinkControl(action);

          return (
            <div key={key} className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.82)' }}>{action.label}</p>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.46)' }}>{action.detail}</p>
              </div>
              {control}
            </div>
          );
        })}
      </div>

      {props.errorMessage ? <p className="error-text mt-3">{props.errorMessage}</p> : null}
    </div>
  );
}