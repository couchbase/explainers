// Makes this the explainer the engine's generic parts read (see
// engine/js/domain.js). Imported first by entry.js.

import { useDomain } from '../../../engine/js/domain.js';
import * as domain from './domain.js';

useDomain(domain);
