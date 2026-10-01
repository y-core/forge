import { journeyWorker } from "../../../src/auth/journey.fixture";
// The shipped DDL rather than a copy, so the journey runs against the schema a consumer applies.
import ddl from "../../../src/auth/schema.sql";

export default journeyWorker(ddl);
