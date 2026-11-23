import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { classifyUtterance, normalizeTranscript, isConfidentEnough } from './voice-intents'
import { mapRecognitionError, getRecognitionCtor } from './speech-support'

test('normalize: punctuation, case, spaces, Hinglish', () => {
  assert.equal(normalizeTranscript('  Hello,   WORLD!! '), 'hello world')
  assert.equal(normalizeTranscript('Haan, kholo'), 'yes open')
  assert.equal(normalizeTranscript(''), '')
})

test('classify: yes/no/stop/repeat/help are whole-phrase only', () => {
  assert.equal(classifyUtterance('yes').kind, 'confirm_yes')
  assert.equal(classifyUtterance('Haan').kind, 'confirm_yes')
  assert.equal(classifyUtterance('nahi').kind, 'confirm_no')
  assert.equal(classifyUtterance('stop listening').kind, 'stop_listening')
  assert.equal(classifyUtterance('repeat').kind, 'repeat')
  assert.equal(classifyUtterance('dobara').kind, 'repeat')
  assert.equal(classifyUtterance('help').kind, 'help')
  // substrings must NOT match
  assert.equal(classifyUtterance('I know the answer').kind, 'text')
  assert.equal(classifyUtterance('cook dinner').kind, 'text')
})

test('classify: unclear for empty, punctuation-only, or single letters', () => {
  assert.equal(classifyUtterance('').kind, 'unclear')
  assert.equal(classifyUtterance('...!!').kind, 'unclear')
  assert.equal(classifyUtterance('a').kind, 'unclear')
})

test('classify: a normal sentence is text and never executes', () => {
  const c = classifyUtterance('show me the projects page')
  assert.equal(c.kind, 'text')
  assert.equal(c.normalized, 'show me the projects page')
})

test('confidence gate', () => {
  assert.equal(isConfidentEnough(undefined), true)
  assert.equal(isConfidentEnough(0.9), true)
  assert.equal(isConfidentEnough(0.1), false)
})

test('recognition error mapping gives friendly, non-leaking messages', () => {
  assert.equal(mapRecognitionError('aborted').message, '')
  assert.match(mapRecognitionError('not-allowed').message, /blocked/)
  assert.equal(mapRecognitionError('not-allowed').retryable, false)
  assert.match(mapRecognitionError('no-speech').message, /didn't hear/)
  assert.equal(mapRecognitionError('weird-code').retryable, true)
})

test('ctor detection handles missing and webkit-prefixed APIs', () => {
  assert.equal(getRecognitionCtor(undefined), null)
  assert.equal(getRecognitionCtor({}), null)
  const Ctor = function () {} as any
  assert.equal(getRecognitionCtor({ webkitSpeechRecognition: Ctor }), Ctor)
  assert.equal(getRecognitionCtor({ SpeechRecognition: Ctor }), Ctor)
})
