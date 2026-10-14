import './setup.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LexicalIndex } from '../src/services/lexical.ts';
import { hit } from './helpers.ts';

describe('keyword search scoped to selected documents', () => {
  const index = new LexicalIndex();
  index.build([
    hit('The termination notice period is three months.', { docId: 'contract-a' }).chunk,
    hit('The termination notice period is one month.', { docId: 'contract-b' }).chunk,
    hit('Holiday schedule for the office.', { docId: 'handbook' }).chunk,
  ]);

  it('searches every document when no scope is given', () => {
    const docs = index.search('termination notice', 10).map((r) => r.chunk.docId);
    assert.deepEqual(docs.sort(), ['contract-a', 'contract-b']);
  });

  it('only returns passages from the selected documents', () => {
    const docs = index.search('termination notice', 10, ['contract-b']).map((r) => r.chunk.docId);
    assert.deepEqual(docs, ['contract-b']);
  });

  it('returns nothing when the selected documents do not match', () => {
    assert.deepEqual(index.search('termination notice', 10, ['handbook']), []);
  });
});
