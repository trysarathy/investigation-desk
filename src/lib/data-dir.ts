// Where the prototype keeps its files until the database lands (week 5). DESK_DATA_DIR overrides
// the default .data/ under the working directory, so tests can run the real routes on a scratch
// directory.

import path from "node:path";

export const dataDir = () => process.env.DESK_DATA_DIR || path.join(process.cwd(), ".data");
