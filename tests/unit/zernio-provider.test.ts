// Checks do adapter Zernio — a rota OFICIAL (Meta Cloud API via Zernio). O que
// mais importa aqui e o extractReferral: e ele que carrega o ctwa_clid, o dado
// que so a rota oficial entrega e do qual depende a atribuicao de anuncio.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ZernioProvider } from '../../supabase/functions/_shared/whatsapp/zernio-provider.ts';

const provider = new ZernioProvider('sk_test_key');

test('referral em message.referral é extraído', () => {
  const got = provider.extractReferral({
    data: {
      message: {
        referral: { ctwa_clid: 'CLID123', source_id: 'AD456', headline: 'Compre agora' },
      },
    },
  });
  assert.deepEqual(got, { ctwa_clid: 'CLID123', source_id: 'AD456', headline: 'Compre agora' });
});

test('referral aninhado em message.context.referral é extraído', () => {
  const got = provider.extractReferral({
    data: { message: { context: { referral: { ctwa_clid: 'CTX789' } } } },
  });
  assert.equal(got?.ctwa_clid, 'CTX789');
  assert.equal(got?.source_id, null);
});

test('referral em data.referral é extraído', () => {
  const got = provider.extractReferral({ data: { referral: { ctwaClid: 'ALT001' } } });
  assert.equal(got?.ctwa_clid, 'ALT001');
});

// Regressao: o encadeamento `x && asObject(x)` parava no primeiro candidato
// truthy, e `{}` e truthy — um referral vazio escondia o de verdade.
test('referral vazio no primeiro candidato não esconde o seguinte', () => {
  const got = provider.extractReferral({
    data: {
      message: {
        referral: {},
        context: { referral: { ctwa_clid: 'ESCONDIDO' } },
      },
    },
  });
  assert.equal(got?.ctwa_clid, 'ESCONDIDO');
});

test('sem ctwa_clid não há referral (não inventa atribuição)', () => {
  assert.equal(provider.extractReferral({ data: { message: { referral: { source_id: 'AD1' } } } }), null);
  assert.equal(provider.extractReferral({ data: { message: {} } }), null);
  assert.equal(provider.extractReferral({}), null);
  assert.equal(provider.extractReferral(null), null);
});
