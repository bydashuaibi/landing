package com.studytrail.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
public class PaymentRulesTest {
 @Test public void payment(){PaymentRules.Result r=PaymentRules.parse("com.tencent.mm","微信支付","付款成功，支付金额￥18.25");assertEquals(1825,r.cents);assertEquals("expense",r.type);}
 @Test public void alipay(){assertEquals(2500,PaymentRules.parse("com.eg.android.AlipayGphone","支付宝","支付成功25元").cents);}
 @Test public void refund(){assertEquals("refund",PaymentRules.parse("com.tencent.mm","微信支付","退款到账￥18.25").kind);}
 @Test public void transfer(){assertEquals("transfer",PaymentRules.parse("com.tencent.mm","微信支付","转账成功，100元").type);}
 @Test public void chatAndCodes(){assertNull(PaymentRules.parse("com.tencent.mm","同学","支付成功￥18.25"));assertNull(PaymentRules.parse("com.tencent.mm","微信支付","验证码123456 支付成功￥18.25"));assertNull(PaymentRules.parse("com.fake","微信支付","支付成功￥18.25"));}
 @Test public void failureAndMarketing(){assertNull(PaymentRules.parse("com.tencent.mm","微信支付","付款失败￥18.25"));assertNull(PaymentRules.parse("com.eg.android.AlipayGphone","支付宝","优惠券￥18.25支付成功"));}
 @Test public void missingOrAmbiguousAmount(){assertEquals(0,PaymentRules.parse("com.tencent.mm","微信支付","支付成功").cents);assertEquals(0,PaymentRules.parse("com.tencent.mm","微信支付","支付成功￥10.00 余额￥80.00").cents);}
 @Test public void incomeAndPrecision(){assertEquals("income",PaymentRules.parse("com.tencent.mm","微信收款助手","收款到账0.01元").type);assertEquals(1,PaymentRules.parse("com.tencent.mm","微信收款助手","收款到账0.01元").cents);}
 @Test public void malformedAndGroupedAmountsAreNotTruncated(){assertEquals(0,PaymentRules.parse("com.tencent.mm","微信支付","支付成功￥1,234.56").cents);assertEquals(0,PaymentRules.parse("com.tencent.mm","微信支付","支付成功1.234元").cents);}
}
