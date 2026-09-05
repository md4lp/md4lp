export type RouteHandler = (params: Record<string, string>, query: URLSearchParams) => void

export interface Route {
  pattern: RegExp
  paramNames: string[]
  handler: RouteHandler
}

export class Router {
  private routes: Route[] = []
  private notFoundHandler: RouteHandler = () => {}

  addRoute(pathPattern: string, handler: RouteHandler): this {
    // Converts paths like "/projects/:id" or "/p/:projectSlug/*docPath" into Regex
    const paramNames: string[] = []
    const regexStr = '^' + pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name)
        return '([^/]+)'
      })
      .replace(/\*([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name)
        return '(.*)'
      }) + '$'

    this.routes.push({
      pattern: new RegExp(regexStr),
      paramNames,
      handler,
    })
    return this
  }

  setNotFound(handler: RouteHandler): this {
    this.notFoundHandler = handler
    return this
  }

  navigate(path: string): void {
    window.location.hash = path.startsWith('#') ? path : `#${path}`
  }

  start(): void {
    const handleLocation = () => {
      const hash = window.location.hash.slice(1) || '/'
      const [pathPart, queryPart] = hash.split('?')
      const path = pathPart || '/'
      const query = new URLSearchParams(queryPart || '')

      for (const route of this.routes) {
        const match = path.match(route.pattern)
        if (match) {
          const params: Record<string, string> = {}
          route.paramNames.forEach((name, i) => {
            params[name] = decodeURIComponent(match[i + 1] || '')
          })
          route.handler(params, query)
          return
        }
      }

      this.notFoundHandler({}, query)
    }

    window.addEventListener('hashchange', handleLocation)
    handleLocation()
  }
}

export const router = new Router()
