import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CreatePage from './pages/CreatePage'
import GuestPage from './pages/GuestPage'
import WallPage from './pages/WallPage'
import RecipientPage from './pages/RecipientPage'
import HostPage from './pages/HostPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/e/:id" element={<GuestPage />} />
        <Route path="/wall/:id" element={<WallPage />} />
        <Route path="/recipient" element={<RecipientPage />} />
        <Route path="/host" element={<HostPage />} />
      </Routes>
    </BrowserRouter>
  )
}
