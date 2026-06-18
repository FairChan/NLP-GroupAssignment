import torch
from torch import nn


class AsymmetricLoss(nn.Module):
    def __init__(
        self,
        gamma_pos: float = 0.0,
        gamma_neg: float = 4.0,
        clip: float = 0.05,
        eps: float = 1e-8,
    ) -> None:
        super().__init__()
        self.gamma_pos = gamma_pos
        self.gamma_neg = gamma_neg
        self.clip = clip
        self.eps = eps

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        targets = targets.float()
        probabilities = torch.sigmoid(logits)
        probabilities_pos = probabilities
        probabilities_neg = 1.0 - probabilities

        if self.clip > 0:
            probabilities_neg = (probabilities_neg + self.clip).clamp(max=1.0)

        positive_loss = targets * torch.log(probabilities_pos.clamp(min=self.eps))
        negative_loss = (1.0 - targets) * torch.log(probabilities_neg.clamp(min=self.eps))

        if self.gamma_pos > 0 or self.gamma_neg > 0:
            positive_weight = torch.pow(1.0 - probabilities_pos, self.gamma_pos)
            negative_weight = torch.pow(1.0 - probabilities_neg, self.gamma_neg)
            positive_loss = positive_loss * positive_weight
            negative_loss = negative_loss * negative_weight

        return -(positive_loss + negative_loss).mean()


class AsymmetricPolynomialLoss(nn.Module):
    def __init__(
        self,
        gamma_pos: float = 0.0,
        gamma_neg: float = 4.0,
        clip: float = 0.05,
        epsilon_pos: float = 1.0,
        epsilon_neg: float = 1.0,
        eps: float = 1e-8,
    ) -> None:
        super().__init__()
        self.gamma_pos = gamma_pos
        self.gamma_neg = gamma_neg
        self.clip = clip
        self.epsilon_pos = epsilon_pos
        self.epsilon_neg = epsilon_neg
        self.eps = eps

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        targets = targets.float()
        probabilities = torch.sigmoid(logits)
        probabilities_pos = probabilities
        probabilities_neg = 1.0 - probabilities

        if self.clip > 0:
            probabilities_neg = (probabilities_neg + self.clip).clamp(max=1.0)

        positive_ce = -torch.log(probabilities_pos.clamp(min=self.eps))
        negative_ce = -torch.log(probabilities_neg.clamp(min=self.eps))

        positive_focus = torch.pow(1.0 - probabilities_pos, self.gamma_pos)
        negative_focus = torch.pow(1.0 - probabilities_neg, self.gamma_neg)
        positive_poly = self.epsilon_pos * torch.pow(1.0 - probabilities_pos, self.gamma_pos + 1.0)
        negative_poly = self.epsilon_neg * torch.pow(probabilities_pos, self.gamma_neg + 1.0)

        positive_loss = targets * (positive_ce * positive_focus + positive_poly)
        negative_loss = (1.0 - targets) * (negative_ce * negative_focus + negative_poly)
        return (positive_loss + negative_loss).mean()
