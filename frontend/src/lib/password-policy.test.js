import { describe, expect, it } from 'vitest'
import * as server from '../../../api/password.js'
import { passwordProblem, normalizeEmail, nameKey, MIN_LENGTH, MAX_LENGTH } from './password-policy.js'

// password-policy.js is a hand copy of api/password.js's rules for the setup with no openGym server.
describe('password-policy.js matches api/password.js', () => {
  const pws = [
    '', 'short', '123456789', '1234567890', 'aaaaaaaaaa', 'abababababab', 'Password123!', 'qwerty.2024',
    'PASSWORD12345', 'correct horse battery', 'ana.2024.2024', 'Ana.2024.2024!', 'gymgymgym1', 'x'.repeat(256),
    'x'.repeat(257) + 'y', 'ｐａｓｓｗｏｒｄ１２３', 'contraseña123', 'a b c d e f g', '🏋️🏋️🏋️🏋️🏋️🏋️🏋️🏋️🏋️🏋️', null, 42,
  ]
  it('on the same passwords and names', () => {
    for (const pw of pws) for (const name of ['', 'Ana', 'ana', 'Lamine', 'gym']) {
      expect(passwordProblem(pw, name), JSON.stringify([pw, name])).toBe(server.passwordProblem(pw, name))
    }
    expect(MIN_LENGTH).toBe(server.MIN_LENGTH)
    expect(MAX_LENGTH).toBe(server.MAX_LENGTH)
  })
  it('on the same e-mails and names', () => {
    for (const e of ['ana@example.com', ' ANA@Example.COM ', 'a@b', 'a@b.c', 'a@.co', 'a..b@x.org', 'no-at.example.com', '', null, 'ｍｅ@ｘ.ｏｒｇ']) {
      expect(normalizeEmail(e), String(e)).toBe(server.normalizeEmail(e))
    }
    for (const n of ['  Ana Lu ', 'ÅNA', 'ﬁt']) expect(nameKey(n)).toBe(server.nameKey(n))
  })
})
