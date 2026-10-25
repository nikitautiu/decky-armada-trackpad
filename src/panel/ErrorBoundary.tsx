import { ModalRoot, PanelSection, PanelSectionRow } from "@decky/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { failureText } from "../logic/failure";
import { MONO, MUTED, NOTE } from "./style";

type Props = {
  readonly children: ReactNode;
  /** Places the failure message, such as inside a modal's root so B still dismisses it; a panel section if unset. */
  readonly frame?: (failure: ReactNode) => ReactNode;
};

type State = { readonly kind: "ok" } | { readonly kind: "failed"; readonly text: string };

/** Shows "Something went wrong" with the error in place of `children` when they throw while rendering. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { kind: "ok" };

  static getDerivedStateFromError(error: unknown): State {
    return { kind: "failed", text: failureText(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Touch Trackpad: a view failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.kind === "ok") return this.props.children;
    const failure = (
      <div style={{ ...NOTE, padding: "8px 0" }}>
        <b>Something went wrong</b>
        <div style={{ ...MONO, ...MUTED, wordBreak: "break-word" }}>{this.state.text}</div>
      </div>
    );
    if (this.props.frame !== undefined) return this.props.frame(failure);
    return (
      <PanelSection>
        <PanelSectionRow>{failure}</PanelSectionRow>
      </PanelSection>
    );
  }
}

type ModalContentProps = {
  readonly render: (close: () => void) => ReactNode;
  readonly close: () => void;
};

/** Calls `render` while React renders it, so an error `render` throws reaches the enclosing boundary. */
function ModalContent({ render, close }: ModalContentProps): ReactNode {
  return render(close);
}

/**
 * The modal `render` draws, with a failure shown in a modal that B or a tap outside closes with `close`.
 *
 * @param render - Draws the modal; called inside the error boundary, so a throw before it returns is caught too.
 */
export function guardedModal(render: (close: () => void) => ReactNode, close: () => void): ReactNode {
  return (
    <ErrorBoundary
      frame={(failure) => (
        <ModalRoot onCancel={close} closeModal={close}>
          {failure}
        </ModalRoot>
      )}
    >
      <ModalContent render={render} close={close} />
    </ErrorBoundary>
  );
}
