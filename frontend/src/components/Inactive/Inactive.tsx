import { authClient } from '../../lib/auth-client'
import AuthLayout from '../AuthLayout/AuthLayout'
import Button from '../Button/Button'

// Signed in, but the subscription that pays for the account has lapsed or
// been cancelled. Cancellation is handled by email, never in the app.
export default function Inactive() {
  return (
    <AuthLayout
      title="Your account is paused"
      subtitle={
        <>
          Your Kabooly Marketing subscription is not active, so the tool is switched off for now. If you think this
          is a mistake, email <a href="mailto:hello@kabooly.com">hello@kabooly.com</a> and we will sort it out.
        </>
      }
    >
      <Button variant="secondary" block onClick={() => void authClient.signOut()} data-testid="inactive-sign-out">
        Sign out
      </Button>
    </AuthLayout>
  )
}
