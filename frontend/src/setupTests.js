import '@testing-library/jest-dom';

// jsdom doesn't ship TextEncoder/Decoder, but Web Crypto + our encryption
// tests need them.
const { TextEncoder, TextDecoder } = require('util')
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder
