import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// OLD OTA SYSTEM DISABLED - Using Custom Self-Hosted API Update System instead
// import { registerOtaServiceWorker } from './services/ota'
import './index.css'

// OLD OTA SYSTEM DISABLED - Using Custom Self-Hosted API Update System instead
// registerOtaServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
