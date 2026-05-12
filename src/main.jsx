import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Removed StrictMode - it causes double mount/unmount in dev,
// which destroys and recreates the Fabric.js canvas + socket connection.
createRoot(document.getElementById('root')).render(<App />)
