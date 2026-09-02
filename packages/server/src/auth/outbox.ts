import { randomUUID } from 'node:crypto'
import type { OutboxEmail } from './types'

export class EmailOutbox {
  private emails: OutboxEmail[] = []

  async sendVerificationCode(to: string, code: string, purpose: string): Promise<OutboxEmail> {
    const subject = `Your md4lp verification code: ${code}`
    const body = [
      `Hello,`,
      ``,
      `Your single-use verification code for ${purpose} is:`,
      ``,
      `    ${code}`,
      ``,
      `This code will expire in 10 minutes. If you did not request this, you can ignore this email.`,
      ``,
      `— md4lp`,
    ].join('\n')

    const record: OutboxEmail = {
      id: randomUUID(),
      to: to.trim().toLowerCase(),
      subject,
      purpose,
      code,
      body,
      sentAt: Date.now(),
    }

    this.emails.push(record)
    // In dev mode, log to console for quick manual visibility
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[outbox] Verification email to ${to}: Code [${code}] (purpose: ${purpose})`)
    }

    return record
  }

  async sendNotificationEmail(to: string, subject: string, body: string, purpose = 'notification'): Promise<OutboxEmail> {
    const record: OutboxEmail = {
      id: randomUUID(),
      to: to.trim().toLowerCase(),
      subject,
      purpose,
      code: '',
      body,
      sentAt: Date.now(),
    }

    this.emails.push(record)
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[outbox] Notification email to ${to}: ${subject}`)
    }

    return record
  }

  async getEmails(to?: string): Promise<OutboxEmail[]> {
    if (!to) return [...this.emails].reverse()
    const norm = to.trim().toLowerCase()
    return this.emails.filter((e) => e.to === norm).reverse()
  }

  async getLatestCode(to: string, purpose?: string): Promise<string | null> {
    const norm = to.trim().toLowerCase()
    const found = [...this.emails]
      .reverse()
      .find((e) => e.to === norm && (!purpose || e.purpose === purpose))
    return found ? found.code : null
  }

  async clear(): Promise<void> {
    this.emails = []
  }
}
