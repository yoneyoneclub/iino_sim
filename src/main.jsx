import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { useAuth, LoginScreen } from './Auth.jsx'

function Root() {
  const { authenticated, login } = useAuth()
  if (!authenticated) {
    return <LoginScreen onLogin={login} />
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
