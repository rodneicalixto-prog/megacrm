import { test, expect } from '@playwright/test';
import { reachStep4LoggedIn, appFieldMessage, setScenario, shot } from '../helpers';

// No real provider credential is used. The setup-only API shim executes the
// production validators while blocking every outbound provider request.
test.beforeEach(async ({ page }) => {
  await setScenario(page, 'default');
  await reachStep4LoggedIn(page);
});

test('Step 4: Salvar is disabled while required providers are empty (cannot skip)', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Salvar e finalizar' })).toBeDisabled();
  await shot(page, 'step4-fields');
});

test('Zernio: bad format -> clear pt-BR error', async ({ page }) => {
  await appFieldMessage(page, 'zernio_api_key', 'garbage');
  await expect(page.getByText('A chave Zernio deve ter o formato sk_ seguido de 64 caracteres hex.')).toBeVisible();
});

test('Zernio: well-formed but rejected offline -> invalid-key error', async ({ page }) => {
  await appFieldMessage(page, 'zernio_api_key', `sk_${'a'.repeat(64)}`);
  await expect(page.getByText('Chave Zernio invalida ou sem permissao.')).toBeVisible();
});

test('Evolution URL: non-HTTPS -> clear pt-BR error', async ({ page }) => {
  await appFieldMessage(page, 'evolution_server_url', 'evolution.local');
  await expect(page.getByText('Informe uma URL HTTPS valida (ex.: https://sua-evolution.com).')).toBeVisible();
});

test('Evolution API key: too short -> clear pt-BR error', async ({ page }) => {
  await appFieldMessage(page, 'evolution_api_key', 'short');
  await expect(page.getByText('API key muito curta.')).toBeVisible();
});

test('Evolution instance: invalid characters -> clear pt-BR error', async ({ page }) => {
  await appFieldMessage(page, 'evolution_instance', 'instancia invalida!');
  await expect(page.getByText('Use apenas letras, numeros, ponto, hifen ou underline.')).toBeVisible();
});

test('OpenAI key: bad prefix -> clear pt-BR error', async ({ page }) => {
  await appFieldMessage(page, 'openai_api_key', 'invalid-key');
  await expect(page.getByText('A chave OpenAI deve comecar com sk-.')).toBeVisible();
});
