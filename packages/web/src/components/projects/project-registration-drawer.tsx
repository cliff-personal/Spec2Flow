import { X } from 'lucide-react';
import { ProjectRegistrationPanel } from '../project-registration-panel';
import type { ProjectRegistrationFormState } from '../../lib/control-plane-ui-types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  formState: ProjectRegistrationFormState;
  onFieldChange: (field: keyof ProjectRegistrationFormState, value: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  errorMessage: string | null;
};

export function ProjectRegistrationDrawer({
  isOpen,
  onClose,
  formState,
  onFieldChange,
  onSubmit,
  isPending,
  errorMessage,
}: Props): JSX.Element {
  if (!isOpen) return <></>;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="fixed right-0 top-0 h-full z-50 flex flex-col p-6 w-[480px] border-l border-[#00F0FF]/15 overflow-y-auto bg-[#1C1B1C]/95 backdrop-blur-2xl"
        style={{ boxShadow: '-20px 0px 40px rgba(0,240,255,0.08)' }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-headline font-bold text-primary-container text-sm uppercase tracking-widest">
            Register Project
          </h2>
          <button
            onClick={onClose}
            className="text-on-surface/40 hover:text-on-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ProjectRegistrationPanel
          formState={formState}
          onFieldChange={onFieldChange}
          onSubmit={onSubmit}
          isPending={isPending}
          errorMessage={errorMessage}
        />
      </div>
    </>
  );
}
