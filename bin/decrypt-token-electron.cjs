const fs = require('fs')
const { app, safeStorage } = require('electron')

app.setName('skill-ui')

function fail(message) {
  console.error(message)
  app.exit(1)
}

app.whenReady().then(() => {
  const settingsPath = process.argv[2]
  if (!settingsPath) fail('Missing settings path')
  let settings
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch (err) {
    fail(`Could not read settings: ${err.message}`)
    return
  }
  if (!settings.tokenEnc) {
    fail('No token stored in settings')
    return
  }
  try {
    const buf = Buffer.from(settings.tokenEnc, 'base64')
    const token = settings.tokenEncrypted ? safeStorage.decryptString(buf) : buf.toString('utf8')
    process.stdout.write(token)
    app.exit(0)
  } catch (err) {
    fail(`Could not decrypt token: ${err.message}`)
  }
})
