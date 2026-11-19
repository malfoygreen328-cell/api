// src/services/logistics/policies/fulfillmentPolicy.js
export const validateParcel = (parcel = {}) => {
  const errors = [];
  if (parcel.weight !== undefined && parcel.weight < 0) errors.push('Invalid weight');
  if (parcel.length !== undefined && parcel.length < 0) errors.push('Invalid length');
  if (parcel.width !== undefined && parcel.width < 0) errors.push('Invalid width');
  if (parcel.height !== undefined && parcel.height < 0) errors.push('Invalid height');

  if (parcel.weight === undefined || parcel.weight === null) {
    errors.push('Missing parcel weight (kg)');
  }
  if (parcel.length === undefined || parcel.length === null) {
    errors.push('Missing parcel length (cm)');
  }
  if (parcel.width === undefined || parcel.width === null) {
    errors.push('Missing parcel width (cm)');
  }
  if (parcel.height === undefined || parcel.height === null) {
    errors.push('Missing parcel height (cm)');
  }

  return { valid: errors.length === 0, errors };
};

export default { validateParcel };

