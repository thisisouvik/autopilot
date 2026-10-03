/**
 * TypeScript 6.0 removed lib.es2015.core.d.ts and no longer ships
 * String.prototype.includes in any sub-lib. This ambient declaration
 * adds it back so paymentTrigger.ts and similar files compile cleanly.
 */
interface String {
  /**
   * Returns true if searchString appears as a substring of the result of
   * converting this object to a String, at one or more positions that are
   * greater than or equal to position; otherwise, returns false.
   * @param searchString search string
   * @param position If position is undefined, 0 is assumed, so as to search all of the String.
   */
  includes(searchString: string, position?: number): boolean;
}
