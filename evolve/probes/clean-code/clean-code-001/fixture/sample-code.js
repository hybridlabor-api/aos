export function calculateDiscount(price, customerType) {
  if (typeof price !== 'number' || price < 0) {
    throw new Error('Price must be a positive number');
  }

  const DISCOUNT_RATE_VIP = 0.20;
  const DISCOUNT_RATE_MEMBER = 0.10;

  if (customerType === 'VIP') {
    return price * (1 - DISCOUNT_RATE_VIP);
  }
  if (customerType === 'MEMBER') {
    return price * (1 - DISCOUNT_RATE_MEMBER);
  }
  return price;
}
