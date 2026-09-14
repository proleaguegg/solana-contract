class RandomStringGenerator {
  private preGeneratedStrings: string[];
  private characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  private stringLength: number;
  private totalPreGenerated: number;

  constructor(stringLength: number, totalPreGenerated: number) {
    this.stringLength = stringLength;
    this.totalPreGenerated = totalPreGenerated;
    this.preGeneratedStrings = [];

    for (let i = 0; i < this.totalPreGenerated; i++) {
      this.preGeneratedStrings.push(this.generateString());
    }
  }

  private generateString(): string {
    let result = '';
    const charactersLength = this.characters.length;
    for (let i = 0; i < this.stringLength; i++) {
      result += this.characters.charAt(
        Math.floor(Math.random() * charactersLength)
      );
    }
    return result;
  }

  public getRandomString(): string {
    const randomIndex = Math.floor(Math.random() * this.totalPreGenerated);
    return this.preGeneratedStrings[randomIndex];
  }
}

// Usage
export const randomStringGenerator = new RandomStringGenerator(10, 1000); // Pre-generate 1000 alphanumeric strings of length 10
