// Тест окончаний строк.
//
// tests/playback-guard.test.js ищет в исходниках точные строки с '\n'.
// Если файл попадётся с CRLF (типичная ловушка Windows-редактора или
// core.autocrlf=true), проверки начнут падать на чистом коде — и причину
// будет найти крайне сложно. Держим зависимые файлы в LF и ловим это здесь.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.join(__dirname, '..');

// Файлы, в которых grep-проверки зависят от переводов строк.
const files = [
    path.join('wwwroot', 'js', 'renderer.js'),
    path.join('wwwroot', 'js', 'api-adapter.js'),
    path.join('wwwroot', 'index.html'),
    path.join('tests', 'playback-guard.test.js'),
    path.join('tests', 'api-adapter-timeout.test.js')
];

const bad = [];
for (const relative of files) {
    const absolute = path.join(root, relative);
    const content = fs.readFileSync(absolute, 'utf8');
    const crlf = (content.match(/\r\n/g) || []).length;
    const loneCr = (content.match(/\r(?!\n)/g) || []).length;
    if (crlf > 0 || loneCr > 0) bad.push(`${relative}: CRLF=${crlf}, одиноких CR=${loneCr}`);
}

assert.deepStrictEqual(
    bad, [],
    'Найдены файлы не в LF — из-за них упадут grep-проверки playback-guard:\n' + bad.join('\n'));

console.log('Line endings: OK');
