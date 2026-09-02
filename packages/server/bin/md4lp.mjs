#!/usr/bin/env node
import { loginWithLoopback, loadAgentAuth, clearAgentAuth, runMcpStdio } from '../src/cli.js'
import { createApi } from '../src/api.js'
import { DEFAULT_CONFIG } from '../src/config.js'

const [,, command, ...args] = process.argv

async function main() {
  switch (command) {
    case 'auth': {
      const sub = args[0]
      if (sub === 'login') {
        const nameIdx = args.indexOf('--name')
        const agentName = nameIdx !== -1 ? args[nameIdx + 1] : 'md4lp CLI'
        console.log(`\n🤖 Starting md4lp browser authorization for "${agentName}"...`)
        try {
          const auth = await loginWithLoopback({ agentName })
          console.log(`\n✅ Connected successfully as: ${auth.agentName}`)
          console.log(`   Token prefix: ${auth.tokenPrefix}`)
          console.log(`   Projects authorized: ${auth.projectScopes.length}`)
          console.log(`   Expires: ${new Date(auth.absoluteExpiresAt).toLocaleString()}`)
        } catch (err) {
          console.error(`\n❌ Login failed:`, err.message || err)
          process.exit(1)
        }
      } else if (sub === 'status') {
        const auth = loadAgentAuth()
        if (!auth) {
          console.log('\n⚠️ No agent session configured. Run `md4lp auth login` to connect.')
        } else {
          console.log(`\n🤖 Active Agent Session: ${auth.agentName}`)
          console.log(`   Server: ${auth.serverUrl}`)
          console.log(`   Token prefix: ${auth.tokenPrefix}`)
          console.log(`   Authorized projects: ${auth.projectScopes.map(s => `${s.projectId} (${s.maxRole})`).join(', ') || 'None'}`)
          console.log(`   Expires: ${new Date(auth.absoluteExpiresAt).toLocaleString()}`)
        }
      } else if (sub === 'logout') {
        const cleared = clearAgentAuth()
        if (cleared) {
          console.log('\n👋 Logged out. Stored agent token removed.')
        } else {
          console.log('\n⚠️ No active session found.')
        }
      } else {
        console.log('Usage: md4lp auth <login|status|logout>')
      }
      break
    }
    case 'mcp': {
      if (args.includes('--stdio')) {
        const repoDir = process.env.MD4LP_REPO || process.cwd()
        const api = createApi(repoDir, DEFAULT_CONFIG)
        await runMcpStdio(api)
      } else {
        console.log('Usage: md4lp mcp --stdio')
      }
      break
    }
    default: {
      console.log(`
md4lp CLI — Markdown service backed by git

Commands:
  md4lp auth login [--name <name>]   Connect an AI agent via browser PKCE loopback
  md4lp auth status                  Check active agent credentials
  md4lp auth logout                  Remove stored agent credentials
  md4lp mcp --stdio                  Run MCP server over stdio for Claude Desktop / Cursor
`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
