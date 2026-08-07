import { Button, FieldError, Input, Label, Modal, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}

export function NewFolderDialog({ open, onOpenChange, onCreate }: NewFolderDialogProps) {
  const { t } = useTranslation();

  const schema = z.object({
    name: z
      .string()
      .trim()
      .min(1, t("folder.nameRequired"))
      .refine((n) => !/[/\\]/.test(n), t("folder.nameInvalid")),
  });

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const onSubmit = handleSubmit(async ({ name }) => {
    try {
      await onCreate(name);
      close(false);
    } catch {
      setError("name", { message: t("folder.createFailed") });
    }
  });

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={close} variant="blur">
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-95">
          <Modal.CloseTrigger />
          {/* HeroUI spaces sections with `header + body` sibling selectors, so
              the form must wrap all three rather than sit between them. */}
          <form onSubmit={onSubmit} className="contents">
            <Modal.Header>
              <Modal.Heading>{t("folder.new")}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Controller
                control={control}
                name="name"
                render={({ field, fieldState }) => (
                  <TextField
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    isInvalid={fieldState.invalid}
                    fullWidth
                  >
                    <Label className="sr-only">{t("folder.namePlaceholder")}</Label>
                    <Input
                      ref={field.ref}
                      autoFocus
                      placeholder={t("folder.namePlaceholder")}
                    />
                    <FieldError>{fieldState.error?.message}</FieldError>
                  </TextField>
                )}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" isPending={isSubmitting}>
                {t("folder.create")}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
