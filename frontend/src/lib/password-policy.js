// The password and e-mail rules of api/password.js, for the setup with no openGym server
// (lib/supabase-api.js), where the app asks them before it sends anything. Hand-copied rather
// than imported, because that module needs node:crypto; password-policy.test.js holds the two
// copies to the same answers. Supabase checks the length rules again on its side
// (supabase/migrations, og.pw_problem).

export const MIN_LENGTH = 10
export const MAX_LENGTH = 256

const normalize = pw => String(pw).normalize('NFKC')
export const passwordLength = pw => [...normalize(pw)].length
export const nameKey = name => String(name || '').normalize('NFKC').trim().toLowerCase()

const COMMON = new Set([
  '1234567890', '0987654321', '12345678910', '123456789012', '1234567890123', '11111111111',
  '1111111111', '0000000000', '9999999999', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4t5',
  'qwertyuiop', 'qwertyuiop[]', 'asdfghjkl;', 'asdfghjkl', 'zxcvbnm,./', '1qaz2wsx3edc',
  'qazwsxedc123', 'qwerty123456', 'qwertz123456', 'azerty123456', 'password12', 'password123',
  'password1234', 'password12345', 'passw0rd123', 'iloveyou123', 'abcdefghij', 'abcd123456',
  'abc1234567', 'a1b2c3d4e5', 'aaaaaaaaaa', 'princess123', 'football123', 'baseball123',
  'sunshine123', 'superman123', 'welcome123', 'welcome1234', 'letmein123', 'trustno1234',
  'changeme123', 'administrator', 'opengym123', 'opengym1234', 'qwerty1234567', '123qweasdzxc',
  'zaq12wsxcde3', '1q2w3e4r5t6y7u', 'q1w2e3r4t5y6', '123123123123', '1234512345',
  '123456123456', 'monkey12345', 'dragon12345', 'master12345', 'shadow12345', 'michael123',
  'jennifer123', 'computer123', 'starwars123', 'whatever123', 'freedom1234', 'pokemon1234',
  'liverpool123', 'chelsea1234', 'arsenal1234', 'barcelona123', 'realmadrid123', 'juventus123',
  'hallo12345', 'passwort123', 'passwort1234', 'motdepasse123', 'contrasena123', 'contraseña123',
  'senha123456', 'parola12345', 'haslo123456', 'wachtwoord123', 'salasana123', 'gymgymgym1'
])
const STEMS = new Set([
  'password', 'passwort', 'passw0rd', 'motdepasse', 'contrasena', 'contraseña', 'senha', 'parola',
  'haslo', 'wachtwoord', 'salasana', 'qwerty', 'qwertz', 'azerty', 'qwertyuiop', 'asdfgh',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'changeme', 'opengym', 'gym',
  'workout', 'fitness', 'dragon', 'monkey', 'football', 'baseball', 'sunshine', 'princess',
  'superman', 'batman', 'master', 'shadow', 'trustno', 'abc', 'abcdef', 'secret', 'login'
])

/** What is wrong with `pw` as a new password for `name`: 'too-short', 'too-long', 'too-common',
 *  or null. */
export function passwordProblem(pw, name) {
  if (typeof pw !== 'string') return 'too-short'
  const len = passwordLength(pw)
  if (len < MIN_LENGTH) return 'too-short'
  if (len > MAX_LENGTH) return 'too-long'
  const low = normalize(pw).toLowerCase()
  if (new Set(low).size <= 2) return 'too-common'
  if (COMMON.has(low)) return 'too-common'
  const stem = low.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
  if (STEMS.has(stem)) return 'too-common'
  const n = nameKey(name)
  if (n.length >= 3 && stem === n) return 'too-common'
  return null
}

export const EMAIL_MAX = 254
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?=.{1,253}$)[^\s@<>()[\]\\,;:"._-][^\s@<>()[\]\\,;:"]*\.[^\s@<>()[\]\\,;:".]{2,}$/u
/** An e-mail address the way it is stored and compared, or null when it is not one. */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null
  const e = nameKey(raw)
  if (!e || [...e].length > EMAIL_MAX || !EMAIL_RE.test(e) || e.includes('..')) return null
  return e
}

// The server's answers for these, word for word (api/server.js POLICY_ERRORS, EMAIL_ERRORS).
export const POLICY_ERRORS = {
  'too-short': `the password needs at least ${MIN_LENGTH} characters`,
  'too-long': `the password can have at most ${MAX_LENGTH} characters`,
  'too-common': 'this password is too easy to guess'
}
export const EMAIL_INVALID = { error: 'that is not an e-mail address', code: 'email-invalid' }
