import './styles/theme.css'
import { router } from './router'
import { api } from './services/api'
import { themeManager } from './services/theme'
import { LoginView } from './views/LoginView'
import { DashboardView } from './views/DashboardView'
import { WorkspaceView } from './views/WorkspaceView'
import { SettingsView } from './views/SettingsView'
import { TeamsView } from './views/TeamsView'
import { ProjectSettingsView } from './views/ProjectSettingsView'
import { AuthorizeAgentView } from './views/AuthorizeAgentView'

// Initialize Theme Manager (syncs with localStorage & system prefers-color-scheme)
themeManager.getTheme()

const app = document.querySelector<HTMLElement>('#app')!

// Router setup
router
  .addRoute('/', () => {
    if (!api.getToken()) {
      router.navigate('/login')
    } else {
      router.navigate('/projects')
    }
  })
  .addRoute('/login', () => {
    new LoginView(app).render()
  })
  .addRoute('/projects', () => {
    new DashboardView(app).render()
  })
  .addRoute('/teams', () => {
    new TeamsView(app).render()
  })
  .addRoute('/settings', () => {
    new SettingsView(app).render()
  })
  .addRoute('/authorize-agent', (_, query) => {
    new AuthorizeAgentView(app, query).render()
  })
  .addRoute('/p/:projectSlug/settings', (params) => {
    new ProjectSettingsView(app, params.projectSlug || '').render()
  })
  .addRoute('/p/:projectSlug', (params) => {
    new WorkspaceView(app, params.projectSlug || '').render()
  })
  .addRoute('/p/:projectSlug/*docPath', (params) => {
    new WorkspaceView(app, params.projectSlug || '', params.docPath || '').render()
  })
  .setNotFound(() => {
    router.navigate('/projects')
  })

// Start SPA
router.start()
