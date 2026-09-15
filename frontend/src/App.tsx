import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell/AppShell'
import { GuestOnly, RequireProfile, RequireVerified } from './components/Guards/Guards'
import ForgotPassword from './pages/ForgotPassword/ForgotPassword'
import Generator from './pages/Generator/Generator'
import Library from './pages/Library/Library'
import Onboarding from './pages/Onboarding/Onboarding'
import Settings from './pages/Settings/Settings'
import SignIn from './pages/SignIn/SignIn'
import VerifyEmail from './pages/VerifyEmail/VerifyEmail'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/sign-in" element={<SignIn mode="sign-in" />} />
        <Route path="/sign-up" element={<SignIn mode="sign-up" />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route path="/verify" element={<VerifyEmail />} />
      <Route element={<RequireVerified />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<RequireProfile />}>
          <Route element={<AppShell />}>
            <Route index element={<Generator />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
