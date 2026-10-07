import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { registerOtaServiceWorker } from './services/ota'
import './index.css'

registerOtaServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
