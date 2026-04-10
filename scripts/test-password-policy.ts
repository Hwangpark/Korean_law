import assert from "node:assert/strict";

import { PASSWORD_POLICY_MESSAGE, passwordPolicy } from "../apps/api/src/auth/password.js";

assert.equal(passwordPolicy("Park8948!"), null);
assert.equal(passwordPolicy("park8948"), PASSWORD_POLICY_MESSAGE);
assert.equal(passwordPolicy("Park8948"), PASSWORD_POLICY_MESSAGE);
assert.equal(passwordPolicy("!!!!!!!!1"), PASSWORD_POLICY_MESSAGE);
assert.equal(passwordPolicy("Pa8!"), PASSWORD_POLICY_MESSAGE);

process.stdout.write("Password policy checks passed.\n");
