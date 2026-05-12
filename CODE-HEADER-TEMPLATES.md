# Unified Algebra Stack — Code Header Templates

Two variants are provided. Use the **Full Header** at the top of every source
file. Use the **Short Header** for generated files, test helpers, or any file
where the full block would be disproportionate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FULL HEADER  (paste at the very top of every .ts / .js source file)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * The Unified Algebra Stack
 * Copyright (c) 2026 James Chapman <xhecarpenxer@gmail.com>
 * Contact: uastack@gmail.com
 *
 * Dual Licensed:
 *   - Community License (free): individuals, non-profits, non-commercial
 *     open source. Source must remain open and non-commercial.
 *   - Commercial / Government License (paid, annual): for-profit companies,
 *     for-profit open source projects, and ALL government entities.
 *     Contact uastack@gmail.com to obtain a license before use.
 *
 * Unauthorized commercial or government use is copyright infringement.
 * See LICENSE for full terms.
 */

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SHORT HEADER  (generated files, test helpers, small utility files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// The Unified Algebra Stack — Copyright (c) 2026 James Chapman <xhecarpenxer@gmail.com>
// Dual licensed: free for non-commercial use; commercial & government use requires
// a paid annual license. Contact uastack@gmail.com — see LICENSE for full terms.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USAGE GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every file under src/, packages/, and tests/ should carry one of these headers
as its very first block — before any imports, before any module doc comments.

Example (src/runtime/types.ts):

    /**
     * The Unified Algebra Stack
     * Copyright (c) 2026 James Chapman <xhecarpenxer@gmail.com>
     * Contact: uastack@gmail.com
     *
     * Dual Licensed:
     *   - Community License (free): individuals, non-profits, non-commercial
     *     open source. Source must remain open and non-commercial.
     *   - Commercial / Government License (paid, annual): for-profit companies,
     *     for-profit open source projects, and ALL government entities.
     *     Contact uastack@gmail.com to obtain a license before use.
     *
     * Unauthorized commercial or government use is copyright infringement.
     * See LICENSE for full terms.
     */

    /**
     * Runtime — Types
     *
     * All types sourced directly from spec Core Types sections 1–9.
     * ...
     */

    import type { IntentList } from "../layer3-intent/types"
    ...
