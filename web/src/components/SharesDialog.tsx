import { Button, Chip, Modal, Spinner, Table, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Copy, Link2Off, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { absoluteUrl, api, shareUrl, type ShareInfo } from "../lib/api";
import { formatDateTime } from "../lib/utils";
import { EmptyState } from "./EmptyState";

interface SharesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SharesDialog({ open, onOpenChange }: SharesDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["shares"],
    queryFn: api.shares,
    enabled: open,
  });

  const revoke = useMutation({
    mutationFn: api.removeShare,
    onSuccess: () => {
      toast.success(t("share.revoked"));
      void queryClient.invalidateQueries({ queryKey: ["shares"] });
    },
    onError: () => toast.danger(t("share.revokeFailed")),
  });

  const copy = (share: ShareInfo) => {
    navigator.clipboard
      .writeText(absoluteUrl(shareUrl(share.token)))
      .then(() => toast.success(t("share.copied")))
      .catch(() => toast.danger(t("file.linkCopyFailed")));
  };

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} variant="blur">
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-200">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("share.manage")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {isLoading ? (
              <div className="grid place-items-center py-12">
                <Spinner aria-label={t("common.loading")} />
              </div>
            ) : isError ? (
              // A failed fetch also leaves `data` undefined, so this has to be
              // checked first — otherwise an outage reads as "no links yet".
              <EmptyState
                icon={CircleAlert}
                title={t("error.shares")}
                description={t("error.sharesDescription")}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    isPending={isFetching}
                    onPress={() => void refetch()}
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : data && data.length > 0 ? (
              // Secondary: the dialog is already a white surface, so a table
              // that paints its own would stack panel on panel.
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label={t("share.manage")}>
                    <Table.Header>
                      {/* The name column absorbs the leftover width so the
                          others never get squeezed into vertical text. */}
                      <Table.Column isRowHeader className="w-full">
                        {t("share.file")}
                      </Table.Column>
                      <Table.Column className="whitespace-nowrap">
                        {t("share.expiresAt")}
                      </Table.Column>
                      <Table.Column className="whitespace-nowrap">
                        {t("share.visits")}
                      </Table.Column>
                      <Table.Column aria-label={t("file.actions")} />
                    </Table.Header>
                    <Table.Body>
                      {data.map((share) => (
                        <Table.Row key={share.token}>
                          {/* max-w-0 is what lets `truncate` bite inside an
                              auto-layout table cell. */}
                          <Table.Cell className="max-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate" title={share.name}>
                                {share.name}
                              </span>
                              {share.hasPassword && (
                                <Chip size="sm" variant="secondary">
                                  {t("share.protected")}
                                </Chip>
                              )}
                            </span>
                          </Table.Cell>
                          <Table.Cell className="whitespace-nowrap">
                            {share.expiresAt === null
                              ? t("share.expiryOption.never")
                              : formatDateTime(share.expiresAt)}
                          </Table.Cell>
                          <Table.Cell className="tabular-nums">
                            {share.visits}
                          </Table.Cell>
                          <Table.Cell className="whitespace-nowrap">
                            <span className="flex justify-end gap-1">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                aria-label={t("share.copy")}
                                onPress={() => copy(share)}
                              >
                                <Copy className="size-4" />
                              </Button>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                aria-label={t("share.revoke")}
                                isPending={
                                  revoke.isPending && revoke.variables === share.token
                                }
                                onPress={() => revoke.mutate(share.token)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </span>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
            ) : (
              <EmptyState
                icon={Link2Off}
                title={t("share.empty")}
                description={t("share.emptyDescription")}
              />
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t("common.close")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
