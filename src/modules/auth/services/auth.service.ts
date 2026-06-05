import { AppException } from '@common/exceptions/app.exception';
import { UsersService } from '@modules/users/services/users.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthMessage } from '../auth.messages';
import type { LoginDto } from '../dto/login.dto';
import type { RegisterDto } from '../dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new AppException(AuthMessage.EMAIL_TAKEN, HttpStatus.CONFLICT);
    }
    const password = await bcrypt.hash(dto.password, 10);
    return this.users.create({ email: dto.email, password, name: dto.name });
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new AppException(AuthMessage.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken };
  }
}
