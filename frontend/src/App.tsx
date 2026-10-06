import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell/AppShell'
import { GuestOnly, RequireProfile, RequireVerified } from './components/Guards/Guards'
import ForgotPassword from './pages/ForgotPassword/ForgotPassword'
import Generator from './pages/Generator/Generator'
import GetFound from './pages/GetFound/GetFound'
import Home from './pages/Home/Home'
import Library from './pages/Library/Library'
import LibraryItem from './pages/LibraryItem/LibraryItem'
import Onboarding from './pages/Onboarding/Onboarding'
import Reviews from './pages/Reviews/Reviews'
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
            <Route index element={<Home />} />
            {/* Keyed by format: moving between them starts a fresh page
                rather than keeping the last result on screen. */}
            <Route path="/create" element={<Generator key="images" format="images" />} />
            <Route path="/create/photo" element={<Generator key="photo" format="photo" />} />
            <Route path="/create/carousel" element={<Generator key="carousel" format="carousel" />} />
            <Route path="/create/video" element={<Generator key="video" format="video" />} />
            {/* The create screens were at the top level until the tool grew
                past adverts, so old links keep working. */}
            <Route path="/photo" element={<Navigate to="/create/photo" replace />} />
            <Route path="/carousel" element={<Navigate to="/create/carousel" replace />} />
            <Route path="/video" element={<Navigate to="/create/video" replace />} />
            <Route path="/get-found" element={<GetFound />} />
            <Route path="/reviews" element={<Reviews />} />
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
