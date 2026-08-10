import test from 'node:test';
import assert from 'node:assert/strict';
import { tr,localizeMarkup,languageMenu } from '../src/i18n.js';

test('keeps Russian text unchanged',()=>{
  assert.equal(tr('🛍 Каталог','ru'),'🛍 Каталог');
});

test('translates interface text and dynamic fragments to English',()=>{
  assert.equal(tr('Цена: 490 ₽\nДоступно: 2','en'),'Price: 490 ₽\nAvailable: 2');
});

test('localizes inline and reply keyboard labels without changing callbacks',()=>{
  const markup={inline_keyboard:[[{text:'← Главное меню',callback_data:'home'}]]};
  const localized=localizeMarkup(markup,'en');
  assert.equal(localized.inline_keyboard[0][0].text,'← Main menu');
  assert.equal(localized.inline_keyboard[0][0].callback_data,'home');
  assert.equal(markup.inline_keyboard[0][0].text,'← Главное меню');
});

test('language selector exposes Russian and English choices with flags',()=>{
  const buttons=languageMenu().inline_keyboard.flat();
  assert.deepEqual(buttons.map(x=>x.callback_data),['lang:ru','lang:en']);
  assert.ok(buttons[0].text.includes('🇷🇺'));
  assert.ok(buttons[1].text.includes('🇬🇧'));
});
