import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import OverlayApp from './Overlay.tsx'
import './index.css'

const params = new URLSearchParams(window.location.search)
const isOverlay = params.get('view') === 'overlay'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <OverlayApp /> : <App />}</StrictMode>,
)
