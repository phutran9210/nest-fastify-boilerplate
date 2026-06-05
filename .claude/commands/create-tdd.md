# /create-tdd — Quy trinh TDD Red-Green-Refactor

Dung lenh nay de phat trien tinh nang hoac sua loi theo quy trinh TDD (Test-Driven Development) cho du an NestJS 11 + Prisma 7 + nestjs-zod + Jest + Biome + pnpm.

**Dau vao:** $ARGUMENTS — mo ta ngan tinh nang/loi can xu ly, hoac duong dan den file/module lien quan.

---

## Buoc 1 — Red: Viet test that bai truoc

Viet test TRUOC KHI co bat ky code implementation nao. Tuan theo quy uoc cua lenh `/create-test`:

- File test dat cung thu muc voi file nguon, ten dang `*.spec.ts`
- Mock bang plain object `useValue`, KHONG dung `jest.fn()` la gia tri truc tiep
- Goi `jest.clearAllMocks()` trong `beforeEach`
- Ten test mo ta hanh vi (behavior-style), vi du: `it('should throw NotFoundException when user not found', ...)`
- Assertion cu the, kiem tra ket qua thuc su (khong chi kiem tra mock duoc goi)

**KHONG DUOC viet bat ky code implementation nao o buoc nay.**

Vi du cau truc test:

```typescript
describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
  });

  it('should throw NotFoundException when user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
  });
});
```

---

## Buoc 2 — Xac nhan test THAT BAI

Chay test va kiem tra no THAT BAI vi dung ly do:

```bash
pnpm test <duong-dan-den-file-spec>
# Hoac chay tat ca:
pnpm test
```

**Kiem tra:**
- Test phai that bai (red) — neu test pass ngay lap tuc, co nghia la test chua kiem tra duoc gi, hay quay lai Buoc 1.
- Test phai that bai vi LY DO DUNG, vi du: `Cannot find module`, `... is not a function`, hoac assertion fail vi chua co implementation.
- Neu test that bai vi loi import hay loi cu phap (syntax error), HAY SUA TEST TRUOC — dung chuyep sang buoc tiep theo khi test bi loi sai ly do.

---

## Buoc 3 — Green: Viet implementation toi thieu

Viet vua du code de test pass. Ap dung quy uoc tu lenh `/coding-convention`:

- Truy cap database qua `PrismaService`, khong goi Prisma truc tiep
- `NotFoundException` dung template literal: `` throw new NotFoundException(`User ${id} not found`) ``
- DTO dung `nestjs-zod` (`createZodDto`)
- Logic ngay/gio dung `Temporal` (khong dung `Date`, `dayjs`, `moment`)
- Import tuong doi (relative), khong dung alias tuyet doi tru `@prisma/client`
- Cau truc flat trong module (tranh long sau nhieu cap thu muc)

**YAGNI:** Chi viet dung nhung gi can thiet de test pass. Khong them tinh nang chua co test.

Sau khi viet xong, chay lai:

```bash
pnpm test <duong-dan-den-file-spec>
```

Test phai PASS (green). Neu van that bai, tiep tuc sua implementation (khong sua test) cho den khi pass.

---

## Buoc 4 — Refactor: Don dep voi test xanh

Khi test da pass, refactor code de cai thien chat luong ma khong thay doi hanh vi:

- Dat ten bien/ham ro rang hon
- Loai bo code trung lap (DRY)
- Tach logic phuc tap thanh ham rieng neu can
- Giu cac test van xanh sau moi thay doi

Sau moi thay doi refactor, chay lai test:

```bash
pnpm test <duong-dan-den-file-spec>
```

**Khong duoc refactor cho den khi test xanh. Khong duoc thay doi hanh vi khi refactor.**

---

## Buoc 5 — Hoan thien: Kiem tra tong the va commit

### Chay tat ca test:

```bash
pnpm test
```

Tat ca test phai pass (khong co failure nao).

### Chay Biome format va lint:

```bash
pnpm check
```

Sua het cac loi lint va format truoc khi commit.

### Commit:

Commit theo tung chu ky red-green-refactor nho. Moi commit ly tuong tuong ung voi mot hanh vi da duoc test va implement:

```bash
git add <cac-file-lien-quan>
git commit -m "feat(<module>): <mo-ta-hanh-vi>"
```

---

## Nguyen tac cam ghi nho

| Nguyen tac | Chi tiet |
|---|---|
| Test truoc, code sau | KHONG BAO GIO viet implementation truoc khi co failing test |
| Mot hanh vi mot lan | Moi chu ky TDD chi xu ly mot case/hanh vi |
| Test phai that bai truoc | Test pass ngay = test khong thuc su kiem tra gi |
| Commit nho | Ly tuong la mot commit cho moi chu ky red-green-refactor |
| Tham chieu lenh khac | Dung `/create-test` cho quy uoc test, `/coding-convention` cho quy uoc code |

---

## Tham chieu nhanh

- Quy uoc viet test: `/create-test`
- Quy uoc viet code: `/coding-convention`
- Chay test: `pnpm test [duong-dan]`
- Kiem tra lint/format: `pnpm check`
