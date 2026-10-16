/** Minimal `@deepseek-ai/dsh-client-ui-primitives` stand-ins for the members the panel uses. */
import type { ReactNode, RefObject } from 'react'

export const Tooltip = ({ children }: { children?: ReactNode; label?: ReactNode; side?: string; delayMs?: number }): ReactNode => <>{children}</>

export function useDismissOnOutsidePointer(_ref: RefObject<unknown>, _open: boolean, _close: (open: boolean) => void): void {}

export const RiskConfirmation = ({ open }: { open: boolean }): ReactNode => (open ? <div data-testid="risk-confirmation" /> : null)
