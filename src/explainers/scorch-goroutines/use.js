// Makes this the explainer the engine's generic parts read (see
// src/js/domain.js). Imported first by entry.js, so it runs before
// anything else.

import { useDomain } from '../../js/domain.js';
import * as domain from './domain.js';

useDomain(domain);
