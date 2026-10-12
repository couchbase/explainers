// Makes this the explainer the engine's generic parts read (see
// src/js/domain.js). Imported first by entry.js.

import { useDomain } from '../../js/domain.js';
import * as domain from './domain.js';

useDomain(domain);
