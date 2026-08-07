import { Button, Card, FieldError, Input, Label, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router";
import { z } from "zod";
import { Logo } from "../components/Logo";
import { api } from "../lib/api";
import { useAuthStore } from "../store/auth";

export default function LoginPage() {
  const { t } = useTranslation();
  const { token, setToken } = useAuthStore();
  const navigate = useNavigate();

  const schema = z.object({
    password: z.string().min(1, t("login.passwordRequired")),
  });

  const {
    control,
    handleSubmit,
    setError,
    formState: { isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  if (token) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      const { token: jwt } = await api.login(password);
      setToken(jwt);
      navigate("/", { replace: true });
    } catch (error) {
      // 429 comes from the rate limiter, not a bad password — saying so stops
      // the user from retyping a password that was actually correct.
      const throttled = axios.isAxiosError(error) && error.response?.status === 429;
      setError("password", {
        message: t(throttled ? "login.throttled" : "login.failed"),
      });
    }
  });

  return (
    <div className="grid min-h-svh place-items-center">
      <Card className="w-[min(360px,calc(100%-32px))] gap-6 p-8">
        <Card.Header className="items-center gap-1 text-center">
          <Logo className="mb-3 size-14" />
          <Card.Title className="text-lg">{t("app.name")}</Card.Title>
          <Card.Description>{t("login.subtitle")}</Card.Description>
        </Card.Header>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <TextField
                name={field.name}
                type="password"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                isInvalid={fieldState.invalid}
                autoComplete="current-password"
                fullWidth
              >
                <Label className="sr-only">{t("login.passwordPlaceholder")}</Label>
                <Input
                  ref={field.ref}
                  autoFocus
                  placeholder={t("login.passwordPlaceholder")}
                />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
          <Button type="submit" variant="primary" fullWidth isPending={isSubmitting}>
            {isSubmitting ? t("login.submitting") : t("login.submit")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
