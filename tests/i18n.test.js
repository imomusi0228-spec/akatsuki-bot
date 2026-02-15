import { t, DICTIONARY } from '../core/i18n.js';

describe('i18n Service', () => {
    test('should load dictionary from JSON', () => {
        expect(DICTIONARY.ja).toBeDefined();
        expect(DICTIONARY.en).toBeDefined();
        expect(DICTIONARY.ja.title).toBe('Akatsuki Bot');
    });

    test('should translate correctly in Japanese', () => {
        expect(t('login', 'ja')).toBe('Discordでログイン');
    });

    test('should translate correctly in English', () => {
        expect(t('login', 'en')).toBe('Login with Discord');
    });

    test('should fallback to key if translate not found', () => {
        expect(t('missing_key', 'ja')).toBe('missing_key');
    });

    test('should replace parameters', () => {
        // 辞書に反映されているか確認（仮に独自キーを追加してテスト）
        DICTIONARY.ja['test_param'] = 'Hello {name}!';
        expect(t('test_param', { name: 'Alice' })).toBe('Hello Alice!');
    });
});
