import { apiClient } from "./client";
import type { CMSDocument, CMSDocumentType } from "./types";

export const cmsApi = {
  document: (type: CMSDocumentType) =>
    apiClient.get<CMSDocument>(`/api/v1/cms/document?type=${type}`),
};
