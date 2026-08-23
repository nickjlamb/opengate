// JSON Schema validation for extraction records — a thin wrapper around ajv,
// kept separate from extraction-check.mjs so the pure comparison core stays
// dependency-free. The schema is the partner's contract: which fields exist,
// their types, and — via nullability — which fields the system may abstain on.
//
// House rule the schema encodes: unknown → null, never guessed. A field the
// system must always find is typed non-nullable ("type": "string"); a field
// the document may not state is nullable ("type": ["string", "null"]). A null
// in a non-nullable required field is then a SCHEMA failure — the gate catches
// a dropped required field without any extra configuration.
//
// ajv runs with strict: false so partners' existing schemas (with $comment,
// custom annotations, etc.) validate as JSON Schema says they should.

import Ajv from 'ajv';

const AjvClass = Ajv.default ?? Ajv;
const ajv = new AjvClass({ allErrors: true, strict: false });
const compiled = new WeakMap();

/**
 * Validate a record against a JSON Schema.
 * @returns {{ valid: boolean, errors: string[] }} errors are readable,
 *   path-first: `/date_of_birth must be string,null`
 */
export function validateRecordAgainstSchema(record, schema) {
  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['no schema provided (cases of kind "extraction" require one)'] };
  }
  let validate = compiled.get(schema);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
    } catch (err) {
      return { valid: false, errors: [`schema does not compile: ${err.message}`] };
    }
    compiled.set(schema, validate);
  }
  const valid = validate(record);
  const errors = (validate.errors || []).map((e) => {
    const path = e.instancePath || '/';
    const allowed = e.params?.allowedValues ? ` (${JSON.stringify(e.params.allowedValues)})` : '';
    return `${path} ${e.message}${allowed}`;
  });
  return { valid: Boolean(valid), errors };
}
