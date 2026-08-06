import test from 'node:test';
import assert from 'node:assert/strict';
import { encrypt,decrypt } from '../src/security.js';
test('codes are encrypted and decrypt correctly',()=>{const raw='CODE-123';const encrypted=encrypt(raw);assert.notEqual(encrypted,raw);assert.equal(decrypt(encrypted),raw)});
