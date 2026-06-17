const tokenUsage = require('./token-usage')

try {
  const now = new Date()
  const local = tokenUsage.summarizeByDay(tokenUsage.usageByDay(), now)
  process.stdout.write(JSON.stringify(local))
} catch (err) {
  process.stderr.write(String(err?.stack || err?.message || err))
  process.exitCode = 1
}
