import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell/AppShell'
import { GuestOnly, RequireProfile, RequireVerified } from './components/Guards/Guards'
import ForgotPassword from './pages/ForgotPassword/ForgotPassword'
import Generator from './pages/Generator/Generator'
import Library from './pages/Library/Library'
import LibraryItem from './pages/LibraryItem/LibraryItem'
import Onboarding from './pages/Onboarding/Onboarding'
import SetPassword from './pages/SetPassword/SetPassword'
import Settings from './pages/Settings/Settings'
import SignIn from './pages/SignIn/SignIn'
import VerifyEmail from './pages/VerifyEmail/VerifyEmail'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/set-password" element={<SetPassword />} />
      </Route>
      <Route path="/verify" element={<VerifyEmail />} />
      <Route element={<RequireVerified />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<RequireProfile />}>
          <Route element={<AppShell />}>
            <Route index element={<Generator />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/:id" element={<LibraryItem />} />
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
